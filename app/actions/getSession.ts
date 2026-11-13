import { cache } from "react";
import { getServerSession } from "next-auth";

import { authOptions } from "../libs/auth";

// cache(): deduped per server request (layouts, pages and actions all ask for it)
const getSession = cache(() => getServerSession(authOptions));

export default getSession;
