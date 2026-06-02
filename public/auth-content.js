(() => {
  if (window.top !== window || window.__koanPlusAuthStarted) return;
  window.__koanPlusAuthStarted = true;

  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const idInput = document.getElementById("USER_ID");
  const passwordInput = document.getElementById("USER_PASSWORD");
  const loginSubmit = document.querySelector('input[name="cmdForm.Submit"]');
  if (idInput instanceof HTMLInputElement &&
      passwordInput instanceof HTMLInputElement &&
      loginSubmit instanceof HTMLInputElement) {
    chrome.runtime.sendMessage({ type: "auth-credentials" }).then((response) => {
      if (!response?.ok || !response.credentials || idInput.value || passwordInput.value) return;
      setValue(idInput, response.credentials.id);
      setValue(passwordInput, response.credentials.password);
      if (response.autoSubmit) {
        chrome.runtime.sendMessage({ type: "auth-submit-idp" }).then((submitResponse) => {
          if (!submitResponse?.ok || !submitResponse.submitted) loginSubmit.click();
        });
      }
    });
    return;
  }

  if (!/認証コード|ワンタイムパスワード|OTP/i.test(document.body.textContent || "")) return;
  const otpInput = [...document.querySelectorAll("input")].find((input) => {
    const hint = [input.id, input.name, input.autocomplete, input.placeholder].join(" ");
    return input instanceof HTMLInputElement &&
      !["hidden", "checkbox", "submit", "button"].includes(input.type) &&
      (/otp|one-time|auth.?code|certification/i.test(hint) || input.maxLength === 6);
  });
  if (!(otpInput instanceof HTMLInputElement) || otpInput.value) return;

  chrome.runtime.sendMessage({ type: "auth-totp" }).then((response) => {
    if (!response?.ok || !response.code || otpInput.value) return;
    setValue(otpInput, response.code);
    const remember = [...document.querySelectorAll('input[type="checkbox"]')].find((input) => {
      const label = input.closest("label")?.textContent || input.parentElement?.textContent || "";
      return /30\s*日間|表示しない/.test(label);
    });
    if (remember instanceof HTMLInputElement && !remember.checked) remember.click();

    const submit = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')].find((button) =>
      /認証|確認/.test(button.textContent || button.value || ""),
    );
    if (response.autoSubmit && submit instanceof HTMLElement) submit.click();
  });
})();
