import { AuthController } from "./authController.js";

export function handleLoginRequest() {
  const controller = new AuthController();
  return controller.login();
}
