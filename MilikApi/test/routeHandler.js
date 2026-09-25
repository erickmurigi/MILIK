// The HR (and a few other) routers define their handlers inline instead of in a controller file. This pulls the final
// handler of one route out of an Express router so it can be run through callController() without an HTTP server.
// The router-level auth middleware (verifyUser, requireCompanyModule) and the app-level permission guard are not run.
//
//   const listEmployees = routeHandler(employeesRouter, "get", "/");
//   const { statusCode, payload } = await callController(listEmployees, { user, query });
export const routeHandler = (router, method, path) => {
  const wanted = String(method).toLowerCase();
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[wanted]);
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${path} route on this router`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
};

export default routeHandler;
