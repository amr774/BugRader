import "reflect-metadata";
import { Controller, Get, HttpException, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { BugRadarModule } from "@bugradar/nestjs-sdk";
@Controller()
class DemoController {
  @Get("health") health() {
    return { status: "ok" };
  }
  @Get("error") fail() {
    throw new Error("Intentional NestJS demo failure");
  }
  @Get("bad-request") badRequest() {
    throw new HttpException(
      { message: "Intentional 400", custom: "preserved" },
      400,
    );
  }
  @Get("http-error") httpError() {
    throw new HttpException(
      { message: "Intentional 503", custom: "preserved" },
      503,
    );
  }
}
@Module({
  imports: [
    BugRadarModule.forRoot({
      endpoint:
        process.env.BUGRADAR_ENDPOINT ?? "http://localhost:3001/ingest/server",
      serverKey: process.env.BUGRADAR_SERVER_KEY ?? "",
      environment: process.env.BUGRADAR_ENVIRONMENT ?? "development",
      release: process.env.BUGRADAR_RELEASE ?? "nest-demo-1.0.0",
    }),
  ],
  controllers: [DemoController],
})
class DemoModule {}
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Intentional-error demo is development-only");
  const app = await NestFactory.create(DemoModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3010), "127.0.0.1");
}
void main();
