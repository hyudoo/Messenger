"use client";

import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { BsGithub, BsGoogle } from "react-icons/bs";
import { FieldValues, SubmitHandler, useForm } from "react-hook-form";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

import Input from "@/app/components/inputs/Input";
import AuthSocialButton from "./AuthSocialButton";
import Button from "@/app/components/Button";
import { TOO_MANY_ATTEMPTS } from "@/app/libs/auth-errors";
import { validatePassword } from "@/app/libs/password";
import { toast } from "react-hot-toast";

type Variant = "LOGIN" | "REGISTER";

interface AuthFormProps {
  // a checked path to open after signing in (safeNextPath), else the inbox
  next?: string | null;
}

const AuthForm: React.FC<AuthFormProps> = ({ next }) => {
  const t = useTranslations("auth");
  const session = useSession();
  const router = useRouter();
  const target = next ?? "/conversations";

  const loginErrorMessage = (error: string) =>
    error === TOO_MANY_ATTEMPTS ? t("login_too_many") : t("login_failed");
  const [variant, setVariant] = useState<Variant>("LOGIN");
  const [isLoading, setIsLoading] = useState(false);

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
      await axios
        .post("/api/register", data)
        .then(() =>
          signIn("credentials", {
            ...data,
            redirect: false,
          })
        )
        .then((callback) => {
          if (callback?.error) {
            toast.error(loginErrorMessage(callback.error));
          }
          if (callback?.ok) {
            router.push(target);
          }
        })
        .catch((error) =>
          toast.error(
            error?.response?.status === 409
              ? t("email_taken")
              : error?.response?.status === 429
              ? t("register_too_many")
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
          if (callback?.error) {
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

  return (
    <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div className="bg-background py-8 px-4 shadow sm:rounded-lg sm:px-10">
        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
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
          <div>
            <Button disabled={isLoading} fullWidth type="submit">
              {variant === "LOGIN" ? t("login") : t("register")}
            </Button>
          </div>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div
              className="
              absolute
              inset-0
              flex
              items-center
             ">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-background px-2 text-muted-foreground">
                {t("or_continue_with")}
              </span>
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <AuthSocialButton
              icon={BsGithub}
              onClick={() => socialAction("github")}
            />
            <AuthSocialButton
              icon={BsGoogle}
              onClick={() => socialAction("google")}
            />
          </div>
        </div>
        <div
          className="
            flex
            gap-2
            justify-center
            text-sm
            mt-6
            px-2
            text-muted-foreground
          ">
          <div>
            {variant === "LOGIN" ? t("no_account") : t("have_account")}
          </div>
          <div onClick={toggleVarriant} className="underline cursor-pointer">
            {variant === "LOGIN" ? t("create_account") : t("login")}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthForm;
