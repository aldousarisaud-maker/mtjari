export default function StorefrontNotFound() {
  // Rendered inside the shop's theme layout; bilingual because the language isn't known here.
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-bold">الصفحة غير موجودة</h1>
      <p className="mt-2 text-lg opacity-70" lang="en" dir="ltr">Page not found</p>
      <p className="mt-8"><a href="/" className="underline underline-offset-4">العودة إلى الرئيسية · Back to home</a></p>
    </div>
  );
}
