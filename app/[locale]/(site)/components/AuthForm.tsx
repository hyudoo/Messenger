"use client";

import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { BsGithub, BsGoogle } from "react-icons/bs";
import { FieldValues, SubmitHandler, useForm } from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

import Input from "@/app/components/inputs/Input";
import AuthSocialButton from "./AuthSocialButton";
import Button from "@/app/components/Button";
import { EMAIL_NOT_VERIFIED, TOO_MANY_ATTEMPTS } from "@/app/libs/auth-errors";
import VerifyEmailNotice from "./VerifyEmailNotice";
import { validatePassword } from "@/app/libs/password";
import { toast } from "react-hot-toast";

type Variant = "LOGIN" | "REGISTER";

interface AuthFormProps {
  // a checked path to open after signing in (safeNextPath), else the inbox
  next?: string | null;
}

const AuthForm: React.FC<AuthFormProps> = ({ next }) => {
  const t = useTranslations("auth");
  const locale = useLocale();
  const session = useSession();
  const router = useRouter();
  const target = next ?? "/conversations";

  const loginErrorMessage = (error: string) =>
    error === TOO_MANY_ATTEMPTS ? t("login_too_many") : t("login_failed");
  const [variant, setVariant] = useState<Variant>("LOGIN");
  const [isLoading, setIsLoading] = useState(false);
  // an account that has to verify its email first: just registered ("sent") or tried to sign in
  // ("unverified"); the form makes way for the notice
  const [verifying, setVerifying] = useState<{ email: string; reason: "sent" | "unverified" } | null>(
    null
  );

  useEffect(() => {
    if (session?.status === "authenticated") {
      router.push(target);
    }
  }, [session?.status, router, target]);

  const toggleVarriant = useCallback(() => {
    if (variant === "LOGIN") {
      setVariant("REGISTER");
    } else {
      setVariant("LOGIN");
    }
  }, [variant]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldValues>({
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const onSubmit: SubmitHandler<FieldValues> = async (data) => {
    setIsLoading(true);

    if (variant === "REGISTER") {
      // same rules as /api/register
      const passwordError = validatePassword(data.password);
      if (passwordError) {
        toast.error(t(`password_rules.${passwordError}`));
        setIsLoading(false);
        return;
      }

      if (data.password !== data.repassword) {
        toast.error(t("password_mismatch"));
        setIsLoading(false);
        return;
      }
      // the account signs in once its email is verified (the mailed link)
      await axios
        .post("/api/register", { ...data, locale })
        .then(() => setVerifying({ email: data.email, reason: "sent" }))
        .catch((error) =>
          toast.error(
            error?.response?.status === 409
              ? t("email_taken")
              : error?.response?.status === 429
              ? t("register_too_many")
              : error?.response?.status === 503
              ? t("register_unavailable")
              : t("register_failed")
          )
        )
        .finally(() => setIsLoading(false));
    }

    if (variant === "LOGIN") {
      signIn("credentials", {
        ...data,
        redirect: false,
      })
        .then((callback) => {
          if (callback?.error === EMAIL_NOT_VERIFIED) {
            setVerifying({ email: data.email, reason: "unverified" });
          } else if (callback?.error) {
            toast.error(loginErrorMessage(callback.error));
          }

          if (callback?.ok && !callback?.error) {
            toast.success(t("login_success"));
            router.push(target);
          }
        })
        .finally(() => setIsLoading(false));
    }
  };

  const socialAction = (action: string) => {
    setIsLoading(true);
    signIn(action, { redirect: false })
      .then((callback) => {
        if (callback?.error) {
          toast.error(t("login_failed"));
        }

        if (callback?.ok) {
          toast.success(t("login_success"));
          router.push(target);
        }
      })
      .finally(() => setIsLoading(false));
  };

  if (verifying) {
    return (
      <VerifyEmailNotice
        email={verifying.email}
        reason={verifying.reason}
        onBack={() => {
          setVerifying(null);
          setVariant("LOGIN");
        }}
      />
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-border bg-background p-6 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.12)] sm:p-8">
        <h2 className="mb-6 text-lg font-semibold tracking-tight text-foreground">
          {variant === "LOGIN" ? t("title") : t("title_register")}
        </h2>
        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
          {variant === "REGISTER" && (
            <Input
              disabled={isLoading}
              register={register}
              errors={errors}
              required
              id="name"
              label={t("name")}
            />
          )}

          <Input
            disabled={isLoading}
            register={register}
            errors={errors}
            required
            id="email"
            label={t("email")}
            type="email"
          />

          <Input
            disabled={isLoading}
            register={register}
            errors={errors}
            required
            id="password"
            label={t("password")}
            type="password"
          />
          {variant === "LOGIN" && (
            <div className="-mt-2 text-right text-sm">
              <Link
                href="/forgot-password"
                className="font-medium text-sky-600 underline-offset-2 hover:underline dark:text-sky-400">
                {t("forgot_password")}
              </Link>
            </div>
          )}
          {variant === "REGISTER" && (
            <Input
              disabled={isLoading}
              register={register}
              errors={errors}
              required
              id="repassword"
              label={t("repassword")}
              type="password"
            />
          )}
          <div className="pt-1">
            <Button disabled={isLoading} fullWidth type="submit">
              {variant === "LOGIN" ? t("login") : t("register")}
            </Button>
          </div>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t("or_continue_with")}
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <AuthSocialButton
            icon={BsGithub}
            label="GitHub"
            disabled={isLoading}
            onClick={() => socialAction("github")}
          />
          <AuthSocialButton
            icon={BsGoogle}
            label="Google"
            disabled={isLoading}
            onClick={() => socialAction("google")}
          />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {variant === "LOGIN" ? t("no_account") : t("have_account")}{" "}
          <button
            type="button"
            onClick={toggleVarriant}
            className="font-medium text-sky-600 underline-offset-2 hover:underline dark:text-sky-400">
            {variant === "LOGIN" ? t("create_account") : t("login")}
          </button>
        </p>
    </div>
  );
};

export default AuthForm;
