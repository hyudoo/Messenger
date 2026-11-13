"use client";

import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { BsGithub, BsGoogle } from "react-icons/bs";
import { FieldValues, SubmitHandler, useForm } from "react-hook-form";
import { useRouter } from "next/navigation";

import Input from "../../components/inputs/Input";
import AuthSocialButton from "./AuthSocialButton";
import Button from "@/app/components/Button";
import { TOO_MANY_ATTEMPTS } from "@/app/libs/auth-errors";
import { validatePassword } from "@/app/libs/password";
import { toast } from "react-hot-toast";

type Variant = "LOGIN" | "REGISTER";

const loginErrorMessage = (error: string) =>
  error === TOO_MANY_ATTEMPTS
    ? "Bạn đăng nhập sai quá nhiều lần, thử lại sau 15 phút!"
    : "Đăng nhập không thành công!";

const AuthForm = () => {
  const session = useSession();
  const router = useRouter();
  const [variant, setVariant] = useState<Variant>("LOGIN");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (session?.status === "authenticated") {
      router.push("/conversations");
    }
  }, [session?.status, router]);

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
        toast.error(passwordError);
        setIsLoading(false);
        return;
      }

      if (data.password !== data.repassword) {
        toast.error("Mật khẩu nhập lại chưa đúng!");
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
            router.push("/conversations");
          }
        })
        .catch((error) =>
          toast.error(
            error?.response?.status === 409
              ? "Email đã được sử dụng!"
              : error?.response?.status === 429
              ? "Bạn đăng ký quá nhiều lần, thử lại sau ít phút!"
              : "Đăng ký tài khoản không thành công!"
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
            toast.success("Đăng nhập thành công!");
            router.push("/conversations");
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
          toast.error("Đăng nhập không thành công!");
        }

        if (callback?.ok) {
          toast.success("Đăng nhập thành công!");
          router.push("/conversations");
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
              label="Họ và tên"
            />
          )}

          <Input
            disabled={isLoading}
            register={register}
            errors={errors}
            required
            id="email"
            label="Email"
            type="email"
          />

          <Input
            disabled={isLoading}
            register={register}
            errors={errors}
            required
            id="password"
            label="Mật khẩu"
            type="password"
          />
          {variant === "REGISTER" && (
            <Input
              disabled={isLoading}
              register={register}
              errors={errors}
              required
              id="repassword"
              label="Nhập lại mật khẩu"
              type="password"
            />
          )}
          <div>
            <Button disabled={isLoading} fullWidth type="submit">
              {variant === "LOGIN" ? "Đăng nhập" : "Đăng ký"}
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
                Hoặc đăng nhập với
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
            {variant === "LOGIN" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}
          </div>
          <div onClick={toggleVarriant} className="underline cursor-pointer">
            {variant === "LOGIN" ? "Tạo tài khoản mới" : "Đăng nhập"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthForm;
