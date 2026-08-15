import { findUserByEmail } from "./userRepository.js";
import { issueToken } from "./tokenService.js";

export class AuthService {
  login() {
    const user = findUserByEmail();
    return issueToken(user.id);
  }
}
