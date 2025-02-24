import { Context } from "../../types";

export async function getUserRole(context: Context, user: string) {
  const orgLogin = context.payload.organization?.login;
  const {
    logger,
    octokit,
    config: {
      autofix: { commentWeights },
    },
  } = context;

  const lowestWeight = Math.min(...Object.values(commentWeights));
  const lowestWeightRole = Object.keys(commentWeights).find((key) => commentWeights[key] === lowestWeight);

  if (!lowestWeightRole) {
    throw new Error("Invalid comment weights");
  }

  if (typeof orgLogin !== "string" || orgLogin.trim() === "") {
    throw new Error("Invalid organization name");
  }

  try {
    const response = await octokit.rest.orgs.getMembershipForUser({
      org: orgLogin,
      username: user,
    });
    return {
      role: response.data.role,
      weight: commentWeights[response.data.role],
    };
  } catch (err) {
    logger.error("Could not get user membership", { err });
  }

  try {
    const permissionLevel = await octokit.rest.repos.getCollaboratorPermissionLevel({
      username: user,
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
    });
    return {
      role: permissionLevel.data.permission,
      weight: commentWeights[permissionLevel.data.permission],
    };
  } catch (err) {
    logger.error("Could not get user role", { err });
  }
  return {
    role: lowestWeightRole,
    weight: lowestWeight,
  };
}
