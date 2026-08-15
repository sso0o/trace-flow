import { AuthService } from "./authService.js";

export class AuthController {
  login() {
    const service = new AuthService();
    return service.login();
  }
}
