import Workspace from "./workspace";
export default function Page() { return <Workspace uploadLimitMb={process.env.VERCEL === "1" ? 4 : 10}/>; }
