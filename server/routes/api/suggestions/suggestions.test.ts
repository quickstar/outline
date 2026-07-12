import { CollectionPermission, TeamPreference } from "@shared/types";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildGroup,
  buildViewer,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#suggestions.mention", () => {
  it("returns only collaborators with access to the current document", async () => {
    const actor = await buildViewer();
    actor.team.setPreference(
      TeamPreference.RestrictUserAndGroupDiscovery,
      true
    );
    await actor.team.save();
    const admin = await buildAdmin({ teamId: actor.teamId });
    const microfastUser = await buildViewer({ teamId: actor.teamId });
    const directUser = await buildViewer({ teamId: actor.teamId });
    const otherUser = await buildViewer({ teamId: actor.teamId });
    const gsz = await buildGroup({
      teamId: actor.teamId,
      userId: admin.id,
      name: "GSZ",
    });
    const microfast = await buildGroup({
      teamId: actor.teamId,
      userId: admin.id,
      name: "microfast Employee",
    });
    const other = await buildGroup({
      teamId: actor.teamId,
      userId: admin.id,
      name: "Other customer",
    });
    await Promise.all([
      gsz.$add("user", actor, { through: { createdById: admin.id } }),
      microfast.$add("user", microfastUser, {
        through: { createdById: admin.id },
      }),
      other.$add("user", otherUser, {
        through: { createdById: admin.id },
      }),
    ]);

    const collection = await buildCollection({
      teamId: actor.teamId,
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
    const document = await buildDocument({
      teamId: actor.teamId,
      collectionId: collection.id,
      userId: admin.id,
    });

    const otherCollection = await buildCollection({
      teamId: actor.teamId,
      userId: admin.id,
      permission: null,
    });
    await Promise.all([
      otherCollection.$add("group", gsz, {
        through: {
          permission: CollectionPermission.ReadWrite,
          createdById: admin.id,
        },
      }),
      otherCollection.$add("group", other, {
        through: {
          permission: CollectionPermission.ReadWrite,
          createdById: admin.id,
        },
      }),
    ]);

    const res = await server.post("/api/suggestions.mention", actor, {
      body: {
        documentId: document.id,
        limit: 25,
      },
    });
    const body = await res.json();
    const userIds = new Set(
      body.data.users.map((user: { id: string }) => user.id)
    );
    const groupIds = new Set(
      body.data.groups.map((group: { id: string }) => group.id)
    );

    expect(res.status).toEqual(200);
    expect(userIds).toEqual(
      new Set([actor.id, admin.id, microfastUser.id, directUser.id])
    );
    expect(userIds.has(otherUser.id)).toEqual(false);
    expect(groupIds).toEqual(new Set([gsz.id, microfast.id]));
    expect(groupIds.has(other.id)).toEqual(false);
  });
});
