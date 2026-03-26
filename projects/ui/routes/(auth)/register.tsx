import { define } from "@/utils.ts";
import RegisterForm from "@/islands/RegisterForm.tsx";

export default define.page(function RegisterPage() {
  return (
    <div class="center-card">
      <RegisterForm />
    </div>
  );
});
