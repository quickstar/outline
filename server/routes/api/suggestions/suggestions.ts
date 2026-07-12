import Router from "koa-router";
import type { WhereOptions } from "sequelize";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { StatusFilter } from "@shared/types";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Document, Group, User } from "@server/models";
import SearchProviderManager from "@server/utils/SearchProviderManager";
import { authorize, can } from "@server/policies";
import {
  presentDocuments,
  presentGroup,
  presentUser,
} from "@server/presenters";
import type { APIContext } from "@server/types";
import {
  getGroupDiscoveryFilter,
  getUserDiscoveryFilter,
} from "@server/utils/DiscoveryScope";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

router.post(
  "suggestions.mention",
  auth(),
  pagination(),
  validate(T.SuggestionsListSchema),
  async (ctx: APIContext<T.SuggestionsListReq>) => {
    const { query, documentId } = ctx.input.body;
    const { offset, limit } = ctx.state.pagination;
    const actor = ctx.state.auth.user;

    const document = documentId
      ? await Document.findByPk(documentId, { userId: actor.id })
      : undefined;
    if (documentId) {
      authorize(actor, "read", document);
    }
    const discoveryContext = document ? { documentId: document.id } : undefined;
    const userDiscoveryFilter = getUserDiscoveryFilter(actor, discoveryContext);
    const groupDiscoveryFilter = getGroupDiscoveryFilter(
      actor,
      discoveryContext
    );

    // Build user query with optional group scoping
    let userWhere: WhereOptions<User> = {
      [Op.and]: [
        userDiscoveryFilter.where,
        {
          teamId: actor.teamId,
          suspendedAt: {
            [Op.eq]: null,
          },
        },
      ],
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
      [Op.and]: [
        groupDiscoveryFilter.where,
        {
          teamId: actor.teamId,
          disableMentions: false,
        },
      ],
    };

    if (query) {
      groupWhere = {
        ...groupWhere,
        [Op.and]: Sequelize.literal(
          `unaccent(LOWER(name)) like unaccent(LOWER(:query))`
        ),
      };
    }

    const replacements = {
      ...userDiscoveryFilter.replacements,
      ...groupDiscoveryFilter.replacements,
      query: `%${query}%`,
    };

    const [documents, users, groups, collections] = await Promise.all([
      SearchProviderManager.getProvider().searchTitlesForUser(actor, {
        query,
        offset,
        limit,
        statusFilter: [StatusFilter.Published],
      }),
      User.findAll({
        where: userWhere,
        order: [["name", "ASC"]],
        replacements,
        offset,
        limit,
      }),
      Group.findAll({
        where: groupWhere,
        order: [["name", "ASC"]],
        replacements,
        offset,
        limit,
      }),
      SearchProviderManager.getProvider().searchCollectionsForUser(actor, {
        query,
        offset,
        limit,
      }),
    ]);

    ctx.body = {
      pagination: ctx.state.pagination,
      data: {
        documents: await presentDocuments(ctx, documents),
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
