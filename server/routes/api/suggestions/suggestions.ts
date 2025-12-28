import Router from "koa-router";
import type { WhereOptions } from "sequelize";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { StatusFilter, TeamPreference } from "@shared/types";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Group, GroupUser, User } from "@server/models";
import SearchHelper from "@server/models/helpers/SearchHelper";
import { can } from "@server/policies";
import { presentDocument, presentGroup, presentUser } from "@server/presenters";
import type { APIContext } from "@server/types";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

router.post(
  "suggestions.mention",
  auth(),
  pagination(),
  validate(T.SuggestionsListSchema),
  async (ctx: APIContext<T.SuggestionsListReq>) => {
    const { query } = ctx.input.body;
    const { offset, limit } = ctx.state.pagination;
    const actor = ctx.state.auth.user;

    // Check if directory isolation is enabled for Viewers/Guests
    const restrictDirectory =
      (actor.isViewer || actor.isGuest) &&
      !!actor.team?.getPreference(TeamPreference.RestrictExternalDirectory);

    // If restricted, get the actor's group IDs to scope results
    let actorGroupIds: string[] = [];
    if (restrictDirectory) {
      actorGroupIds = await actor.groupIds();
    }

    // Build user query with optional group scoping
    let userWhere: WhereOptions<User> = {
      teamId: actor.teamId,
      suspendedAt: {
        [Op.eq]: null,
      },
    };

    if (query) {
      userWhere = {
        ...userWhere,
        [Op.and]: {
          [Op.or]: [
            Sequelize.literal(
              `unaccent(LOWER(email)) like unaccent(LOWER(:query))`
            ),
            Sequelize.literal(
              `unaccent(LOWER(name)) like unaccent(LOWER(:query))`
            ),
          ],
        },
      };
    }

    // Build group query with optional scoping
    let groupWhere: WhereOptions<Group> = {
      teamId: actor.teamId,
      disableMentions: false,
    };

    if (query) {
      groupWhere = {
        ...groupWhere,
        [Op.and]: Sequelize.literal(
          `unaccent(LOWER(name)) like unaccent(LOWER(:query))`
        ),
      };
    }

    // If directory is restricted, scope to actor's groups
    if (restrictDirectory && actorGroupIds.length > 0) {
      // Get user IDs who are in the same groups as the actor
      const groupUsers = await GroupUser.findAll({
        where: {
          groupId: {
            [Op.in]: actorGroupIds,
          },
        },
        attributes: ["userId"],
      });
      const allowedUserIds = [
        ...new Set(groupUsers.map((gu) => gu.userId)),
        actor.id,
      ];

      userWhere = {
        ...userWhere,
        id: {
          [Op.in]: allowedUserIds,
        },
      };

      // Scope groups to only those the actor is a member of
      groupWhere = {
        ...groupWhere,
        id: {
          [Op.in]: actorGroupIds,
        },
      };
    } else if (restrictDirectory && actorGroupIds.length === 0) {
      // Actor has no groups, only show themselves
      userWhere = {
        ...userWhere,
        id: actor.id,
      };
      // No groups to show
      groupWhere = {
        ...groupWhere,
        id: {
          [Op.in]: [],
        },
      };
    }

    const [documents, users, groups, collections] = await Promise.all([
      SearchHelper.searchTitlesForUser(actor, {
        query,
        offset,
        limit,
        statusFilter: [StatusFilter.Published],
      }),
      User.findAll({
        where: userWhere,
        order: [["name", "ASC"]],
        replacements: { query: `%${query}%` },
        offset,
        limit,
      }),
      Group.findAll({
        where: groupWhere,
        order: [["name", "ASC"]],
        replacements: { query: `%${query}%` },
        offset,
        limit,
      }),
      SearchHelper.searchCollectionsForUser(actor, { query, offset, limit }),
    ]);

    ctx.body = {
      pagination: ctx.state.pagination,
      data: {
        documents: await Promise.all(
          documents.map((document) => presentDocument(ctx, document))
        ),
        users: users.map((user) =>
          presentUser(user, {
            includeEmail: !!can(actor, "readEmail", user),
            includeDetails: !!can(actor, "readDetails", user),
          })
        ),
        groups: await Promise.all(groups.map((group) => presentGroup(group))),
        collections,
      },
    };
  }
);

export default router;
