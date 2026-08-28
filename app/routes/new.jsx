/** /new now lives at the root — permanent redirect keeps old links working. */
import { redirect } from "react-router";
export const loader = () => redirect("/", 301);
