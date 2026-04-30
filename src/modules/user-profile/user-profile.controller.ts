/**
 * UserProfile controller — `/me/profile` endpoints.
 *
 * Both routes are inherently scoped to the current user — there's
 * no `:id` param. The user can ONLY see their own profile,
 * identified by the authenticated session.
 */

import { Body, Controller, Get, Patch, Req } from "@nestjs/common";

import { Can } from "../../core/permissions/can.guard.js";
import { ZodValidationPipe } from "../../core/validation/zod-validation.pipe.js";

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

function requireCurrentUser(req: AuthedRequest): { id: string; tenantId: string } {
  const id = req.user?.id;
  const tenantId = req.user?.tenantId;
  if (!id || !tenantId) {
    throw new Error("user-profile: no authenticated user on request");
  }
  return { id, tenantId };
}
