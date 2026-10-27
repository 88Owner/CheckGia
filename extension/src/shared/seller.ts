export const SELLER_HOSTS = ["banhang.shopee.vn", "banhang.shopee.com"];
const STOREFRONT_HOST = /^(?:.+\.)?shopee\.(?:vn|com)$/;

export interface SellerPageInfo {
  isSeller: boolean;
  isProductPage: boolean;
  isLogin: boolean;
}

export function analyzeSellerUrl(url: string | undefined): SellerPageInfo {
  if (!url) return { isSeller: false, isProductPage: false, isLogin: false };
  try {
    const parsed = new URL(url);
    const isSeller = SELLER_HOSTS.includes(parsed.hostname);
    const isProductPage = isSeller && /\/portal\/product(\/|$)/.test(parsed.pathname);
    const isLogin = /login|signin/i.test(parsed.pathname);
    return { isSeller, isProductPage, isLogin };
  } catch {
    return { isSeller: false, isProductPage: false, isLogin: false };
  }
}

export function isStorefrontProductUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (SELLER_HOSTS.includes(parsed.hostname) || !STOREFRONT_HOST.test(parsed.hostname)) return false;
    return /-i\.\d+\.\d+/.test(parsed.pathname) || /\/product\/\d+\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export const PRODUCT_PAGE_MESSAGE = "Vui lòng mở trang Quản lý sản phẩm hoặc trang chi tiết sản phẩm Shopee.";
export const BACKEND_OFFLINE_MESSAGE = "Local Backend chưa chạy.";
export const VERIFICATION_MESSAGE = "Trang yêu cầu xác minh. Vui lòng xử lý thủ công rồi chạy lại.";
export const CURRENT_PAGE_MESSAGE = "Đang kiểm tra trang hiện tại.";
export const EMPTY_PAGE_MESSAGE = "Không tìm thấy sản phẩm trên trang hiện tại.";
