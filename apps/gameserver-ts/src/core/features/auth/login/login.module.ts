import { LoginHandler } from "@features/auth/login/login.handler";
import { LoginHandshake } from "@features/auth/login/login.handshake";
import { LoginRepository } from "@features/auth/login/login.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [LoginHandler, LoginHandshake, LoginRepository],
})
export class LoginModule {}
