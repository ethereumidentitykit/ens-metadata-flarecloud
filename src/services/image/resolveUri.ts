import type { Env } from "../../env";
import { getNetwork } from "../../lib/networks";
import { badRequest, HttpError } from "../../lib/errors";
import { resolveRecord, type AvatarKind } from "../avatarResolver";
import { deleteResolved, getResolved, putResolved } from "../../storage/kvCache";

export async function resolveUriCached(
  env: Env,
  kind: AvatarKind,
  networkName: string,
  name: string,
  ctx: ExecutionContext,
): Promise<string> {
  const cached = await getResolved(env, kind, networkName, name);
  if (cached?.fresh) return cached.uri;

  const network = getNetwork(env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);

  if (cached) {
    ctx.waitUntil(
      (async () => {
        try {
          const uri = await resolveRecord(network, kind, name);
          await putResolved(env, kind, networkName, name, uri);
        } catch (err) {
          if (err instanceof HttpError && err.status === 404) {
            await deleteResolved(env, kind, networkName, name);
            return;
          }
          console.error(
            `stale revalidation failed for ${kind}:${networkName}:${name}:`,
            err,
          );
        }
      })(),
    );
    return cached.uri;
  }

  const uri = await resolveRecord(network, kind, name);
  ctx.waitUntil(putResolved(env, kind, networkName, name, uri));
  return uri;
}
