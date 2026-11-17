import axios from "axios";
import { toast } from "react-hot-toast";

// Message commands shared by the hover menu (MessageBox) and the touch menu (MessageMenuSheet).

export const togglePin = (
  messageId: string,
  pinned: boolean,
  t: (key: "pin_failed" | "pin_limit") => string
) =>
  axios
    .post(`/api/messages/${messageId}/pin`, { pinned })
    .catch((error) =>
      toast.error(error?.response?.status === 409 ? t("pin_limit") : t("pin_failed"))
    );

// deleted for the user only: the server tells their tabs (messages:hide), which drop it
export const deleteForMe = (messageId: string, failed: string) =>
  axios
    .delete(`/api/messages/${messageId}`, { params: { scope: "me" } })
    .catch(() => toast.error(failed));
