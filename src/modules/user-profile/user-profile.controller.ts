/**
 * UserProfile controller — `/me/profile` endpoints.
 *
 * Two routes, both inherently scoped to the current user:
 *   - GET  /me/profile    → read your own profile
 *   - PATCH /me/profile   → edit your own profile
 *
 * No `:id` parameter on either route — the user can ONLY see their
 * own profile, identified by the authenticated session. That's the
 * key difference from the example module: data scoping is by
 * `req.user.id`, not by URL params.
 */

import { Body, Controller, Get, Patch, Req } from "@nestjs/common";

import { Can } from "../../core/permissions/can.guard.js";
import { ZodValidationPipe } from "../../core/validation/zod-validation.pipe.js";

import { requireCurrentUser } from "./require-current-user.js";
import {
  type UpdateUserProfileDto,
  UpdateUserProfileSchema,
  type UserProfileResponse,
} from "./user-profile.dto.js";
import { UserProfileService } from "./user-profile.service.js";

interface AuthedRequest {
  user?: { id?: string; tenantId?: string };
}

@Controller("me/profile")
export class UserProfileController {
  constructor(private readonly service: UserProfileService) {}

  @Can("read", "UserProfile")
  @Get()
  async getMine(@Req() req: AuthedRequest): Promise<UserProfileResponse> {
    const { id, tenantId } = requireCurrentUser(req);
    return this.service.getOrCreate(tenantId, id);
  }

  @Can("update", "UserProfile")
  @Patch()
  async updateMine(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateUserProfileSchema)) dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    const { id, tenantId } = requireCurrentUser(req);
    return this.service.update(tenantId, id, dto);
  }
}
