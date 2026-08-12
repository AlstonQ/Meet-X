import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";
import { loadConfig } from "@meet-x/config";

const config = loadConfig(process.env);
const app = await NestFactory.create(AppModule);

await app.listen(config.API_PORT);
