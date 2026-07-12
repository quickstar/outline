import { Op } from "sequelize";
import {
  CollectionPermission,
  DocumentPermission,
  TeamPreference,
} from "@shared/types";
import { Group, GroupMembership, User, UserMembership } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildGroup,
  buildTeam,
  buildViewer,
} from "@server/test/factories";
import {
  getGroupDiscoveryFilter,
  getUserDiscoveryFilter,
} from "./DiscoveryScope";

describe("DiscoveryScope", () => {
  it("returns collaborators across shared collections", async () => {
    const team = await buildTeam();
    team.setPreference(TeamPreference.RestrictUserAndGroupDiscovery, true);
    await team.save();

    const admin = await buildAdmin({ teamId: team.id });
    const actor = await buildViewer({ teamId: team.id, name: "GSZ actor" });
    const gszUser = await buildViewer({
      teamId: team.id,
      name: "GSZ colleague",
    });
    const microfastUser = await buildViewer({
      teamId: team.id,
      name: "Microfast employee",
    });
    const directUser = await buildViewer({
      teamId: team.id,
      name: "Direct collaborator",
    });
    const unrelatedUser = await buildViewer({
      teamId: team.id,
      name: "Unrelated user",
    });
    const gsz = await buildGroup({
      teamId: team.id,
      userId: admin.id,
      name: "GSZ",
    });
    const microfast = await buildGroup({
      teamId: team.id,
      userId: admin.id,
      name: "microfast Employee",
    });
    const unrelated = await buildGroup({
      teamId: team.id,
      userId: admin.id,
      name: "Unrelated",
    });

    await Promise.all([
      gsz.$add("user", actor, { through: { createdById: admin.id } }),
      gsz.$add("user", gszUser, { through: { createdById: admin.id } }),
      microfast.$add("user", microfastUser, {
        through: { createdById: admin.id },
      }),
      unrelated.$add("user", unrelatedUser, {
        through: { createdById: admin.id },
      }),
    ]);

    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    await Promise.all([
      collection.$add("group", gsz, {
        through: {
          permission: CollectionPermission.ReadWrite,
          createdById: admin.id,
        },
      }),
      collection.$add("group", microfast, {
        through: {
          permission: CollectionPermission.ReadWrite,
          createdById: admin.id,
        },
      }),
      collection.$add("user", directUser, {
        through: {
          permission: CollectionPermission.Admin,
          createdById: admin.id,
        },
      }),
    ]);

    const userFilter = getUserDiscoveryFilter(actor);
    const users = await User.findAll({
      where: {
        [Op.and]: [{ teamId: team.id }, userFilter.where],
      },
      replacements: userFilter.replacements,
    });
    const userIds = new Set(users.map((user) => user.id));

    expect(userIds).toEqual(
      new Set([actor.id, admin.id, gszUser.id, microfastUser.id, directUser.id])
    );
    expect(userIds.has(unrelatedUser.id)).toEqual(false);

    const groupFilter = getGroupDiscoveryFilter(actor);
    const groups = await Group.findAll({
      where: {
        [Op.and]: [{ teamId: team.id }, groupFilter.where],
      },
      replacements: groupFilter.replacements,
    });
    const groupIds = new Set(groups.map((group) => group.id));

    expect(groupIds).toEqual(new Set([gsz.id, microfast.id]));
    expect(groupIds.has(unrelated.id)).toEqual(false);
  });

  it("includes inherited collection collaborators for a directly shared document", async () => {
    const team = await buildTeam();
    team.setPreference(TeamPreference.RestrictUserAndGroupDiscovery, true);
    await team.save();

    const admin = await buildAdmin({ teamId: team.id });
    const actor = await buildViewer({ teamId: team.id });
    const collaborator = await buildViewer({ teamId: team.id });
    const group = await buildGroup({ teamId: team.id, userId: admin.id });
    await group.$add("user", collaborator, {
      through: { createdById: admin.id },
    });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    await Promise.all([
      UserMembership.create({
        userId: actor.id,
        documentId: document.id,
        permission: DocumentPermission.Read,
        createdById: admin.id,
      }),
      GroupMembership.create({
        groupId: group.id,
        collectionId: collection.id,
        permission: CollectionPermission.Read,
        createdById: admin.id,
      }),
    ]);

    const userFilter = getUserDiscoveryFilter(actor);
    const visibleUsers = await User.findAll({
      where: {
        [Op.and]: [{ teamId: team.id }, userFilter.where],
      },
      replacements: userFilter.replacements,
    });
    const groupFilter = getGroupDiscoveryFilter(actor);
    const visibleGroups = await Group.findAll({
      where: {
        [Op.and]: [{ teamId: team.id }, groupFilter.where],
      },
      replacements: groupFilter.replacements,
    });

    expect(visibleUsers.map((user) => user.id)).toContain(collaborator.id);
    expect(visibleGroups.map((visibleGroup) => visibleGroup.id)).toContain(
      group.id
    );
  });
});
