CREATE TYPE "EventSource" AS ENUM ('BROWSER', 'SERVER');
ALTER TABLE "Project" ADD COLUMN "serverKeyHash" TEXT, ADD COLUMN "serverKeyPrefix" TEXT;
CREATE UNIQUE INDEX "Project_serverKeyHash_key" ON "Project"("serverKeyHash");
ALTER TABLE "Issue" ADD COLUMN "source" "EventSource" NOT NULL DEFAULT 'BROWSER';
ALTER TABLE "Event" ADD COLUMN "source" "EventSource" NOT NULL DEFAULT 'BROWSER', ADD COLUMN "requestMethod" TEXT, ADD COLUMN "routeTemplate" TEXT;
