import { resolveAzureIdentity } from "./resolveIdentity";

describe("resolveAzureIdentity", () => {
  it("uses Graph mail for contact and UPN for authorization", () => {
    expect(
      resolveAzureIdentity(
        { email: "token@personal.example" },
        {
          mail: "contact@personal.example",
          userPrincipalName: "user@company.example",
        }
      )
    ).toEqual({
      email: "contact@personal.example",
      emailVerified: true,
      domain: "company.example",
    });
  });

  it("uses a verified token email when Graph mail is unavailable", () => {
    expect(
      resolveAzureIdentity(
        { email: "contact@personal.example", xms_edov: true },
        { userPrincipalName: "user@company.example" }
      )
    ).toEqual({
      email: "contact@personal.example",
      emailVerified: true,
      domain: "company.example",
    });
  });

  it("uses UPN as the fallback contact email", () => {
    expect(
      resolveAzureIdentity({}, { userPrincipalName: "user@company.example" })
    ).toEqual({
      email: "user@company.example",
      emailVerified: true,
      domain: "company.example",
    });
  });

  it("does not trust an unverified token email", () => {
    expect(
      resolveAzureIdentity(
        { email: "contact@personal.example" },
        { userPrincipalName: "user@company.example" }
      )
    ).toEqual({
      email: "contact@personal.example",
      emailVerified: undefined,
      domain: "company.example",
    });
  });

  it("throws when no email identity is available", () => {
    expect(() => resolveAzureIdentity({}, {})).toThrow(
      "'email' property is required"
    );
  });
});
