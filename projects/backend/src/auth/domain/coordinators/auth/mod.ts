import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  createOrg,
  getOrg,
  getOrgBySlug,
  listOrgs,
  deleteOrg,
  createUser,
  getUser,
  deleteUser,
  verifyUser,
  listUsers,
  listUsersBySupervisor,
  createSession,
  getSession,
  deleteSession,
  refreshSession,
  validatePassword,
  parseCookie,
  authenticate,
  sessionCookie,
  clearSessionCookie,
  resolveEffectiveAuth,
} from "./impl.ts";

@Injectable()
export class AuthCoordinator {
  // Org CRUD
  createOrg = createOrg;
  getOrg = getOrg;
  getOrgBySlug = getOrgBySlug;
  listOrgs = listOrgs;
  deleteOrg = deleteOrg;

  // User CRUD
  createUser = createUser;
  getUser = getUser;
  deleteUser = deleteUser;
  verifyUser = verifyUser;
  listUsers = listUsers;
  listUsersBySupervisor = listUsersBySupervisor;

  // Sessions
  createSession = createSession;
  getSession = getSession;
  deleteSession = deleteSession;
  refreshSession = refreshSession;

  // Password validation
  validatePassword = validatePassword;

  // Request Auth Helpers
  parseCookie = parseCookie;
  authenticate = authenticate;
  sessionCookie = sessionCookie;
  clearSessionCookie = clearSessionCookie;
  resolveEffectiveAuth = resolveEffectiveAuth;
}

// Re-export types for consumers
export type {
  Role,
  OrgRecord,
  UserRecord,
  AuthContext,
  VerifyResult,
} from "./impl.ts";
