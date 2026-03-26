import { define } from "@/utils.ts";
import LoginForm from "@/islands/LoginForm.tsx";

export default define.page(function LoginPage() {
  return (
    <div class="center-card">
      <LoginForm />
    </div>
  );
});
