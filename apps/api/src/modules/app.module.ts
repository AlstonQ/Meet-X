import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AuthController } from "./auth.controller.js";
import { DemoController } from "./demo.controller.js";
import { HealthController } from "./health.controller.js";
import { LocalAgentController } from "./local-agent.controller.js";
import { LiveTranscriptionController } from "./live-transcription.controller.js";
import { LiveViewController } from "./live-view.controller.js";
import { PrototypeController } from "./prototype.controller.js";
import { RecorderController } from "./recorder.controller.js";

@Module({
  controllers: [AppController, AuthController, DemoController, HealthController, LocalAgentController, LiveTranscriptionController, LiveViewController, PrototypeController, RecorderController]
})
export class AppModule {
  private readonly moduleName = "app";
}

