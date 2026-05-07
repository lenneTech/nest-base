import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { resolveBrandConfig } from "./brand.js";
import { BrevoEmailDriver, createBrevoHttpClient } from "./drivers/brevo.driver.js";
import {
  SmtpEmailDriver,
  createSmtpTransporter,
  readSmtpConfigFromEnv,
} from "./drivers/smtp.driver.js";
import { selectEmailDriver, type EmailDriverName } from "./email.module.js";
import { serializeOutboxTickError } from "./email-outbox-error.js";
import { ReactEmailTemplateRenderer } from "./email-templates.react.js";
import {
  EmailOutboxRecorder,
  EmailOutboxWorker,
  type EmailOutboxDriver,
  type EmailOutboxRecord,
  type EmailOutboxStorage,
} from "./email-outbox.js";
import { PrismaEmailOutboxStorage } from "./email-outbox.prisma.js";
import {
  type EmailDriver,
  type EmailMessage,
  type EmailSendResult,
  type EmailTemplateRenderer,
} from "./email.service.js";
import { loadFeatures } from "../features/features.js";
import { loadBrandSync } from "../branding/brand-loader.js";
import { EMAIL_OUTBOX_RECORDER } from "./email-outbox.token.js";

/**
 * EmailOutboxModule — wires the recorder, the worker, and the
 * Prisma storage so EmailService can switch to outbox mode for
 * at-least-once delivery (issue #11).
 *
 * The worker runs as a per-second tick lifecycle hook
 * (`OnModuleInit` starts the timer, `OnModuleDestroy` stops it).
 * The tick interval is configurable via `EMAIL_OUTBOX_TICK_MS` so
 * dev can poll fast and prod can poll slower.
 *
 * Driver selection mirrors `EmailModule` — same env / feature
 * matrix — but the worker holds its own driver instance to keep
 * the dispatch path independent of `EmailService`'s caches.
 */
export const EMAIL_OUTBOX_STORAGE = Symbol.for("lt:EmailOutboxStorage");
export const EMAIL_OUTBOX_DRIVER = Symbol.for("lt:EmailOutboxDriver");

const DEFAULT_TICK_MS = 1000;

/**
 * Adapter: bridges EmailService-style drivers into the
 * EmailOutboxDriver shape the worker expects.
 *
 * The worker doesn't care about EmailService's whitelist /
 * rate-limit (those ran at enqueue time). It only needs to send
 * the persisted message via the configured transport.
 */
class EmailServiceDriverAdapter implements EmailOutboxDriver {
  constructor(
    private readonly primary: EmailDriver,
    private readonly transactional: EmailDriver | null,
    private readonly renderer: EmailTemplateRenderer,
    private readonly defaultFrom: string,
  ) {}

  async dispatch(record: EmailOutboxRecord): Promise<EmailSendResult> {
    if (record.kind === "send") {
      const opts = record.payload as {
        to: string;
        from?: string;
        subject: string;
        html?: string;
        text?: string;
      };
      const message: EmailMessage = {
        to: opts.to,
        from: opts.from ?? this.defaultFrom,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      };
      return this.primary.send(message);
    }
    // sendTemplate
    const opts = record.payload as {
      to: string;
      template: string;
      locale?: string;
      vars?: object;
      brevoTemplateId?: number;
      from?: string;
    };
    const vars = opts.vars ?? {};
    if (opts.brevoTemplateId !== undefined) {
      if (!this.transactional) {
        throw new Error("email-outbox: brevoTemplateId set but no transactional driver wired");
      }
      const baseMessage: EmailMessage = {
        to: opts.to,
        from: opts.from ?? this.defaultFrom,
        subject: "",
      };
      return this.transactional.sendTemplate(baseMessage, opts.brevoTemplateId, vars);
    }
    const locale = opts.locale ?? "en";
    const rendered = await this.renderer.render(opts.template, locale, vars);
    return this.primary.send({
      to: opts.to,
      from: opts.from ?? this.defaultFrom,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
}

/**
 * Log-only stand-in driver — same shape used in EmailModule. Kept
 * local so EmailOutboxModule doesn't import the LogOnly class out
 * of EmailModule (avoids a circular dependency).
 */
class LogOnlyEmailDriver implements EmailDriver {
  readonly name = "log-only";
  private readonly logger = new Logger("EmailOutbox");
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.logger.log(`[email-outbox] to=${msg.to} subject="${msg.subject}" via=${this.name}`);
    return { messageId: `log-${Date.now()}`, driver: this.name };
  }
  async sendTemplate(
    msg: EmailMessage,
    templateId: number,
    vars: object,
  ): Promise<EmailSendResult> {
    this.logger.log(
      `[email-outbox] templateId=${templateId} to=${msg.to} vars=${JSON.stringify(vars)} via=${this.name}`,
    );
    return { messageId: `log-tpl-${templateId}-${Date.now()}`, driver: this.name };
  }
}

function createDriver(name: EmailDriverName, env: Record<string, string | undefined>): EmailDriver {
  if (name === "log-only") return new LogOnlyEmailDriver();
  if (name === "smtp") {
    const cfg = readSmtpConfigFromEnv(env);
    if (!cfg) return new LogOnlyEmailDriver();
    return new SmtpEmailDriver({ transporter: createSmtpTransporter(cfg) });
  }
  // brevo
  const apiKey = env.BREVO_API_KEY ?? "";
  return new BrevoEmailDriver({ apiKey, http: createBrevoHttpClient({ apiKey }) });
}

@Injectable()
export class EmailOutboxRecorderProvider extends EmailOutboxRecorder {
  constructor(@Inject(EMAIL_OUTBOX_STORAGE) storage: EmailOutboxStorage) {
    super({ storage });
  }
}

export const EMAIL_OUTBOX_PG_BOSS = Symbol.for("lt:EmailOutboxPgBoss");
export const EMAIL_OUTBOX_PGBOSS_QUEUE = "lt.email-outbox.dispatch";
export const EMAIL_OUTBOX_PGBOSS_CRON = "* * * * *";

@Injectable()
export class EmailOutboxWorkerLifecycle implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("EmailOutboxWorker");
  private readonly worker: EmailOutboxWorker;
  private timer?: ReturnType<typeof setInterval>;
  private readonly tickMs: number;
  private readonly isTest: boolean;
  private bossActive = false;

  constructor(
    @Inject(EMAIL_OUTBOX_STORAGE) storage: EmailOutboxStorage,
    @Inject(EMAIL_OUTBOX_DRIVER) driver: EmailOutboxDriver,
    @Optional()
    @Inject(EMAIL_OUTBOX_PG_BOSS)
    private readonly boss:
      | import("../jobs/scheduled-job-pgboss-scheduler.js").PgBossLike
      | null = null,
  ) {
    const env = process.env as Record<string, string | undefined>;
    const raw = env.EMAIL_OUTBOX_TICK_MS ? Number.parseInt(env.EMAIL_OUTBOX_TICK_MS, 10) : NaN;
    this.tickMs = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TICK_MS;
    this.isTest = env.NODE_ENV === "test";
    this.worker = new EmailOutboxWorker({ storage, driver });
  }

  async onModuleInit(): Promise<void> {
    // Multi-instance deployments enable pg-boss so the worker tick
    // is leader-claimed rather than running concurrently from every
    // replica. Single-instance deployments keep
    // `FEATURE_JOBS_PG_BOSS=false` and fall back to setInterval; the
    // SQL `claim()` prevents double-dispatch within a process either
    // way.
    if (this.boss) {
      try {
        await this.boss.work(EMAIL_OUTBOX_PGBOSS_QUEUE, () => this.worker.runOnce());
        await this.boss.schedule(EMAIL_OUTBOX_PGBOSS_QUEUE, EMAIL_OUTBOX_PGBOSS_CRON);
        this.bossActive = true;
        this.logger.log(
          `email-outbox dispatch scheduled via pg-boss (queue="${EMAIL_OUTBOX_PGBOSS_QUEUE}", cron="${EMAIL_OUTBOX_PGBOSS_CRON}")`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `pg-boss email-outbox scheduling failed; falling back to setInterval: ${err}`,
        );
      }
    }
    // In test environments the automatic tick races with specs that share
    // the email_outbox table — concurrent AppModule instances would claim
    // each other's rows before the owning test's worker can dispatch them.
    // Tests that need dispatch call tickOnce() explicitly.
    if (this.isTest) return;
    this.timer = setInterval(() => {
      this.worker.runOnce().catch((err) => {
        // Logger.error(rawError) collapses non-Error throws to "{}"
        // (issue #50). Always route through the serializer so the
        // real cause + payload reach the log.
        const { message, stack, payload } = serializeOutboxTickError(err);
        this.logger.error(`outbox tick failed: ${message}${payload ? ` (${payload})` : ""}`, stack);
      });
    }, this.tickMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.bossActive = false;
  }

  /** Test hook — runs one tick on demand. */
  async tickOnce(): Promise<void> {
    await this.worker.runOnce();
  }

  /** Test hook — surfaces which mode the lifecycle picked. */
  isPgBossActive(): boolean {
    return this.bossActive;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_OUTBOX_STORAGE,
      useFactory: (prisma: PrismaService) => new PrismaEmailOutboxStorage(prisma),
      inject: [PrismaService],
    },
    {
      provide: EMAIL_OUTBOX_DRIVER,
      useFactory: (): EmailOutboxDriver => {
        const env = process.env as Record<string, string | undefined>;
        const features = loadFeatures(env);
        const selection = selectEmailDriver({
          enabled: features.email.enabled,
          provider: features.email.provider,
          env,
        });
        const renderer = new ReactEmailTemplateRenderer({ brand: resolveBrandConfig() });
        const primary = createDriver(selection.primary, env);
        const transactional = selection.transactional
          ? createDriver(selection.transactional, env)
          : null;
        const brand = loadBrandSync();
        const defaultFrom = env.SMTP_FROM ?? brand.fromEmail;
        return new EmailServiceDriverAdapter(primary, transactional, renderer, defaultFrom);
      },
    },
    EmailOutboxRecorderProvider,
    // Alias the recorder under the dedicated injection token so
    // EmailModule (and any consumer) can opt-in to outbox-mode
    // without importing the recorder class directly.
    {
      provide: EMAIL_OUTBOX_RECORDER,
      useExisting: EmailOutboxRecorderProvider,
    },
    {
      provide: EMAIL_OUTBOX_PG_BOSS,
      useFactory: () => resolveEmailOutboxPgBoss(),
    },
    EmailOutboxWorkerLifecycle,
  ],
  exports: [
    EmailOutboxRecorderProvider,
    EMAIL_OUTBOX_RECORDER,
    EMAIL_OUTBOX_STORAGE,
    EmailOutboxWorkerLifecycle,
  ],
})
export class EmailOutboxModule {}

async function resolveEmailOutboxPgBoss(): Promise<
  import("../jobs/scheduled-job-pgboss-scheduler.js").PgBossLike | null
> {
  const enabled = process.env.FEATURE_JOBS_PG_BOSS === "true";
  const url = process.env.DATABASE_URL;
  if (!enabled || !url) return null;
  const mod = await import("pg-boss");
  type PgBossLike = import("../jobs/scheduled-job-pgboss-scheduler.js").PgBossLike;
  const Ctor: new (cs: string) => unknown = mod.PgBoss;
  const instance = new Ctor(url);
  if (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as { start?: unknown }).start === "function" &&
    typeof (instance as { work?: unknown }).work === "function" &&
    typeof (instance as { schedule?: unknown }).schedule === "function" &&
    typeof (instance as { stop?: unknown }).stop === "function"
  ) {
    return instance as PgBossLike;
  }
  return null;
}
