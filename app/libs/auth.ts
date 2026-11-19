import bcrypt from "bcrypt"
import { AuthOptions, Session } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GithubProvider from "next-auth/providers/github"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { PrismaClient } from "@prisma/client"

import prisma from "@/app/libs/prismadb"
import { EMAIL_NOT_VERIFIED, TOO_MANY_ATTEMPTS } from "@/app/libs/auth-errors"
import { needsEmailVerification } from "@/app/libs/email-verification"
import { clientIp, rateLimit } from "@/app/libs/rate-limit"
import { currentSessionVersion, isSessionCurrent } from "@/app/libs/session-version"

export const authOptions: AuthOptions = {
  // the adapter's types predate client options like `omit`; at runtime it only calls CRUD methods
  adapter: PrismaAdapter(prisma as unknown as PrismaClient),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID as string,
      clientSecret: process.env.GITHUB_SECRET as string
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'email', type: 'text' },
        password: { label: 'password', type: 'password' }
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Invalid credentials');
        }

        // slows down password guessing; the form shows a dedicated message for this error
        const ip = clientIp(req?.headers)
        if (
          !(await rateLimit('loginIp', ip)).ok ||
          !(await rateLimit('login', `${ip}:${credentials.email}`)).ok
        ) {
          throw new Error(TOO_MANY_ATTEMPTS)
        }

        // the only query that reads hashedPassword (omitted globally)
        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          },
          omit: { hashedPassword: false, mustVerifyEmail: false }
        });

        if (!user || !user?.hashedPassword) {
          throw new Error('Invalid credentials');
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password,
          user.hashedPassword
        );

        if (!isCorrectPassword) {
          throw new Error('Invalid credentials');
        }

        // only after the password: an unverified account is no secret to someone who knows it
        if (needsEmailVerification(user)) {
          throw new Error(EMAIL_NOT_VERIFIED);
        }

        const { hashedPassword, mustVerifyEmail, ...safeUser } = user;
        return safeUser;
      }
    })
  ],
  debug: process.env.NODE_ENV === 'development',
  session: {
    strategy: "jwt",
  },
  callbacks: {
    // a new session remembers the user's session version (app/libs/session-version.ts)
    async jwt({ token, user }) {
      if (user) {
        token.sv = (await currentSessionVersion(user.id, { fresh: true })) ?? 0
      }
      return token
    },
    // A token from before a password change / "sign out other devices" (or of a deleted user) gives
    // no session: an empty one makes getServerSession return null and useSession "unauthenticated".
    // proxy.ts also deletes its cookie on protected pages.
    async session({ session, token }) {
      if (!(await isSessionCurrent(token))) {
        return {} as Session
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}
