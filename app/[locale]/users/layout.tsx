import getFriendRequests from "@/app/actions/getFriendRequests";
import getUsers from "@/app/actions/getUsers";
import Sidebar from "@/app/components/sidebar/Sidebar";
import UserList from "./components/UserList";

export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [friends, requests] = await Promise.all([getUsers(), getFriendRequests()]);

  return (
    <Sidebar>
      <div className="h-full">
        <UserList items={friends} incoming={requests.incoming} outgoing={requests.outgoing} />
        {children}
      </div>
    </Sidebar>
  );
}
