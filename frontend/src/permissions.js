export const canAccess = (session, module, action) => session?.role === 'ADMINISTRADOR' || session?.permissions?.includes('*.*') || session?.permissions?.includes(`${module}.${action}`)
