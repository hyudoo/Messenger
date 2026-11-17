import { getLocale, getTranslations } from "next-intl/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { findInvitedGroup } from "@/app/actions/getInvite";
import AvatarGroup from "@/app/components/AvatarGroup";
import { Link, redirect } from "@/i18n/navigation";
import JoinButton from "./JoinButton";

interface IParams {
  code: string;
}

// An invite link (/join/<code>): the group's photo, name and size, and a button to join it.
// proxy.ts sends signed-out visitors to the login page and back here. Members go straight to the
// chat; a reset or turned-off link says so.
const JoinPage = async ({ params }: { params: Promise<IParams> }) => {
  const { code } = await params;
  const t = await getTranslations("join");
  const [currentUser, group] = await Promise.all([getCurrentUser(), findInvitedGroup(code)]);

  if (group && currentUser && group.userIds.includes(currentUser.id)) {
    return redirect({ href: `/conversations/${group.id}`, locale: await getLocale() });
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8 text-center shadow">
        {group ? (
          <>
            <div className="flex justify-center">
              <AvatarGroup users={group.users} image={group.image} />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{t("invited")}</p>
            <h1 className="mt-1 break-words text-xl font-semibold text-foreground">{group.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("members", { count: group.userIds.length })}
            </p>
            <JoinButton code={code} />
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">{t("invalid_title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("invalid")}</p>
          </>
        )}
        <Link
          href="/conversations"
          className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
          {t("back")}
        </Link>
      </div>
    </div>
  );
};

export default JoinPage;
