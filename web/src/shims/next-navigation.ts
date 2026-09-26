// next/navigation 的替身：直接转接到 @/router（真路由）。
//
// 原版组件只用到这 4 个：notFound / useRouter / usePathname / useSearchParams。
export { usePathname, useRouter, useSearchParams, notFound } from "@/router";
