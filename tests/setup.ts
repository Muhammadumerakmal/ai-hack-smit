import { aroundAll, aroundEach } from "vitest";
import { runInCompany } from "@/lib/tenant";

// Every fixture builds its data in company 1. Services that tests call directly run inside it, the same way a
// signed-in request does (route tests go through withSession, which switches to the caller's own company).
aroundAll((runSuite) => runInCompany(1, runSuite));
aroundEach((runTest) => runInCompany(1, runTest));
