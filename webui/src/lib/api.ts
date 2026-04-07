const BASE_URL = "";

function getToken(): string | null {
  return localStorage.getItem("ow_token");
}

async function request<T>(method: string, path: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { method, headers });

  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string) => request<T>("POST", path),
  put: <T>(path: string) => request<T>("PUT", path),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
