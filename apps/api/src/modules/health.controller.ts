import { Controller, Get } from "@nestjs/common";

type HealthResponse = {
  status: "ok";
  service: "api";
};

@Controller()
export class HealthController {
  @Get("/health")
  health(): HealthResponse {
    return {
      status: "ok",
      service: "api"
    };
  }
}
