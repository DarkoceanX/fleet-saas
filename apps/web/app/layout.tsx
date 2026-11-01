import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "Fleet · Рейсы и себестоимость",
  description: "Локальная система управления автопарком",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
