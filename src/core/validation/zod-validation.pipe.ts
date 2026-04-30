import { type ArgumentMetadata, Injectable, type PipeTransform } from "@nestjs/common";
import { type ZodType } from "zod";

/**
 * Map-and-Validate pipe.
 *
 * The pipe parses the inbound value through the supplied Zod schema
 * and returns the parsed result. Failures throw the original `ZodError`
 * so the global Problem-Details filter can format the response (see
 * `ProblemDetailsExceptionFilter`).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    return this.schema.parse(value);
  }
}
