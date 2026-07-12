import type { WhereOptions } from "sequelize";
import { Op, literal } from "sequelize";
import { TeamPreference, UserRole } from "@shared/types";
import type { Group, User } from "@server/models";

/** Context used to narrow discovery results to a specific resource. */
export interface DiscoveryContext {
  documentId?: string;
}

/** A database filter and its bound replacements. */
export interface DiscoveryFilter<T> {
  where: WhereOptions<T>;
  replacements: Record<string, string>;
}

/**
 * Returns whether user and group discovery is restricted for the actor.
 *
 * @param actor The user requesting discovery entries.
 * @returns whether user and group discovery is restricted.
 */
export function isDiscoveryRestricted(actor: User): boolean {
  return (
    (actor.isViewer || actor.isGuest) &&
    !!actor.team?.getPreference(TeamPreference.RestrictUserAndGroupDiscovery)
  );
}

/**
 * Builds the user visibility filter for an actor.
 *
 * @param actor The user requesting discovery entries.
 * @param context Optional resource context for the request.
 * @returns the user visibility filter and bound replacements.
 */
export function getUserDiscoveryFilter(
  actor: User,
  context?: DiscoveryContext
): DiscoveryFilter<User> {
  if (!isDiscoveryRestricted(actor)) {
    return emptyFilter();
  }

  const sql = context?.documentId
    ? documentDiscoverySql("users")
    : globalDiscoverySql(actor, "users");

  return {
    where: {
      id: {
        [Op.in]: literal(`(${sql})`),
      },
    },
    replacements: replacements(actor, context),
  };
}

/**
 * Builds the group visibility filter for an actor.
 *
 * @param actor The user requesting discovery entries.
 * @param context Optional resource context for the request.
 * @returns the group visibility filter and bound replacements.
 */
export function getGroupDiscoveryFilter(
  actor: User,
  context?: DiscoveryContext
): DiscoveryFilter<Group> {
  if (!isDiscoveryRestricted(actor)) {
    return emptyFilter();
  }

  const sql = context?.documentId
    ? documentDiscoverySql("groups")
    : globalDiscoverySql(actor, "groups");

  return {
    where: {
      id: {
        [Op.in]: literal(`(${sql})`),
      },
    },
    replacements: replacements(actor, context),
  };
}

function emptyFilter<T>(): DiscoveryFilter<T> {
  return {
    where: {},
    replacements: {},
  };
}

function replacements(
  actor: User,
  context?: DiscoveryContext
): Record<string, string> {
  return {
    discoveryActorId: actor.id,
    discoveryTeamId: actor.teamId,
    discoveryGuestRole: UserRole.Guest,
    ...(context?.documentId ? { discoveryDocumentId: context.documentId } : {}),
  };
}

function globalDiscoverySql(actor: User, target: "users" | "groups"): string {
  const allMembersAccess = actor.isGuest
    ? ""
    : 'OR collection."permission" IS NOT NULL';

  return `
    WITH actor_groups AS (
      SELECT group_user."groupId"
      FROM group_users AS group_user
      INNER JOIN groups AS actor_group
        ON actor_group.id = group_user."groupId"
        AND actor_group."teamId" = :discoveryTeamId
        AND actor_group."deletedAt" IS NULL
      WHERE group_user."userId" = :discoveryActorId
    ),
    accessible_collections AS (
      SELECT collection.id, collection."permission"
      FROM collections AS collection
      WHERE collection."teamId" = :discoveryTeamId
        AND collection."deletedAt" IS NULL
        AND (
          EXISTS (
            SELECT 1
            FROM user_permissions AS user_permission
            WHERE user_permission."collectionId" = collection.id
              AND user_permission."userId" = :discoveryActorId
          )
          OR EXISTS (
            SELECT 1
            FROM group_permissions AS group_permission
            INNER JOIN actor_groups
              ON actor_groups."groupId" = group_permission."groupId"
            WHERE group_permission."collectionId" = collection.id
              AND group_permission."deletedAt" IS NULL
          )
          ${allMembersAccess}
        )
    ),
    accessible_documents AS (
      SELECT document.id, document."collectionId"
      FROM documents AS document
      WHERE document."teamId" = :discoveryTeamId
        AND document."deletedAt" IS NULL
        AND (
          document."collectionId" IN (
            SELECT accessible_collection.id
            FROM accessible_collections AS accessible_collection
          )
          OR EXISTS (
            SELECT 1
            FROM user_permissions AS user_permission
            WHERE user_permission."documentId" = document.id
              AND user_permission."userId" = :discoveryActorId
          )
          OR EXISTS (
            SELECT 1
            FROM group_permissions AS group_permission
            INNER JOIN actor_groups
              ON actor_groups."groupId" = group_permission."groupId"
            WHERE group_permission."documentId" = document.id
              AND group_permission."deletedAt" IS NULL
          )
        )
    ),
    collaboration_collections AS (
      SELECT accessible_collection.id, accessible_collection."permission"
      FROM accessible_collections AS accessible_collection
      UNION
      SELECT collection.id, collection."permission"
      FROM collections AS collection
      INNER JOIN accessible_documents AS accessible_document
        ON accessible_document."collectionId" = collection.id
      WHERE collection."deletedAt" IS NULL
    ),
    visible_groups AS (
      SELECT actor_group."groupId"
      FROM actor_groups AS actor_group
      UNION
      SELECT group_permission."groupId"
      FROM group_permissions AS group_permission
      INNER JOIN groups AS visible_group
        ON visible_group.id = group_permission."groupId"
        AND visible_group."teamId" = :discoveryTeamId
        AND visible_group."deletedAt" IS NULL
      WHERE group_permission."deletedAt" IS NULL
        AND (
          group_permission."collectionId" IN (
            SELECT collaboration_collection.id
            FROM collaboration_collections AS collaboration_collection
          )
          OR group_permission."documentId" IN (
            SELECT accessible_document.id
            FROM accessible_documents AS accessible_document
          )
        )
    )
    ${target === "users" ? globalVisibleUsersSql() : visibleGroupsSql()}
  `;
}

function documentDiscoverySql(target: "users" | "groups"): string {
  return `
    WITH discovery_document AS (
      SELECT document.id, document."collectionId"
      FROM documents AS document
      WHERE document.id = :discoveryDocumentId
        AND document."teamId" = :discoveryTeamId
        AND document."deletedAt" IS NULL
    ),
    visible_groups AS (
      SELECT group_permission."groupId"
      FROM group_permissions AS group_permission
      INNER JOIN groups AS visible_group
        ON visible_group.id = group_permission."groupId"
        AND visible_group."teamId" = :discoveryTeamId
        AND visible_group."deletedAt" IS NULL
      WHERE group_permission."deletedAt" IS NULL
        AND (
          group_permission."documentId" IN (
            SELECT document.id
            FROM discovery_document AS document
          )
          OR group_permission."collectionId" IN (
      SELECT document."collectionId"
      FROM discovery_document AS document
            WHERE document."collectionId" IS NOT NULL
          )
        )
    )
    ${target === "users" ? documentVisibleUsersSql() : visibleGroupsSql()}
  `;
}

function visibleGroupsSql(): string {
  return `
    SELECT visible_group."groupId"
    FROM visible_groups AS visible_group
  `;
}

function globalVisibleUsersSql(): string {
  return `
    SELECT :discoveryActorId
    UNION
    SELECT group_user."userId"
    FROM group_users AS group_user
    INNER JOIN visible_groups AS visible_group
      ON visible_group."groupId" = group_user."groupId"
    UNION
    SELECT user_permission."userId"
    FROM user_permissions AS user_permission
    WHERE user_permission."collectionId" IN (
      SELECT collaboration_collection.id
      FROM collaboration_collections AS collaboration_collection
    )
      OR user_permission."documentId" IN (
        SELECT accessible_document.id
        FROM accessible_documents AS accessible_document
      )
    UNION
    SELECT discovery_user.id
    FROM users AS discovery_user
    WHERE discovery_user."teamId" = :discoveryTeamId
      AND discovery_user.role <> :discoveryGuestRole
      AND discovery_user."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM collaboration_collections AS collaboration_collection
        WHERE collaboration_collection."permission" IS NOT NULL
      )
  `;
}

function documentVisibleUsersSql(): string {
  return `
    SELECT :discoveryActorId
    UNION
    SELECT group_user."userId"
    FROM group_users AS group_user
    INNER JOIN visible_groups AS visible_group
      ON visible_group."groupId" = group_user."groupId"
    UNION
    SELECT user_permission."userId"
    FROM user_permissions AS user_permission
    WHERE user_permission."documentId" IN (
      SELECT document.id
      FROM discovery_document AS document
    )
      OR user_permission."collectionId" IN (
        SELECT document."collectionId"
      FROM discovery_document AS document
        WHERE document."collectionId" IS NOT NULL
      )
    UNION
    SELECT discovery_user.id
    FROM users AS discovery_user
    WHERE discovery_user."teamId" = :discoveryTeamId
      AND discovery_user.role <> :discoveryGuestRole
      AND discovery_user."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM collections AS collection
        INNER JOIN discovery_document AS document
          ON document."collectionId" = collection.id
        WHERE collection."permission" IS NOT NULL
          AND collection."deletedAt" IS NULL
      )
  `;
}
