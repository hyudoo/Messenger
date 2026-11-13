// Next 16 "proxy" (formerly middleware): sends signed-out users on protected pages to the login page.
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/",
  },
});

export const config = {
  matcher: ["/conversations/:path*", "/users/:path*", "/room/:path*"],
};
