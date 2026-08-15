export function useAdminRole() {
  async function executeUpdateRole(id: string, role: string): Promise<boolean> {
    await updateAdminRole(id, role);
    return true;
  }

  return { executeUpdateRole };
}

function updateAdminRole(id: string, role: string): Promise<void> {
  return Promise.resolve();
}
