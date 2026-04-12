import React, { lazy } from 'react';
import { RouteObject } from 'react-router-dom';
import { cleanNil } from '@/utils/nil';

const Shell = lazy(() => import('@/components/Shell'));
const Home = lazy(() => import('@/pages/Home'));
const MusicApp = lazy(() => import('@/pages/MusicApp'));
const Diary = lazy(() => import('@/pages/Diary'));
const Email = lazy(() => import('@/pages/Email'));
const CyberNews = lazy(() => import('@/pages/CyberNews'));

// All sub-pages should use lazy loading
const routerList: RouteObject[] = [
  {
    path: '/home',
    element: (
      <React.Suspense>
        <Home />
      </React.Suspense>
    ),
  },
  {
    path: '/musicPlayer',
    element: (
      <React.Suspense>
        <MusicApp />
      </React.Suspense>
    ),
  },
  {
    path: '/diary',
    element: (
      <React.Suspense>
        <Diary />
      </React.Suspense>
    ),
  },
  {
    path: '/email',
    element: (
      <React.Suspense>
        <Email />
      </React.Suspense>
    ),
  },
  {
    path: '/cyberNews',
    element: (
      <React.Suspense>
        <CyberNews />
      </React.Suspense>
    ),
  },
];

interface RouterItemConfig {
  path?: RouteObject['path'];
  element?: RouteObject['element'];
  children?: RouteObject['children'];
  index?: RouteObject['index'];
  handle?: RouteObject['handle'];
  meta?: Record<string, unknown>;
}

const generateRootRouter = (list: RouterItemConfig[]): RouteObject[] => {
  const traverse = (config: RouterItemConfig) => {
    const temp = cleanNil({
      path: config?.path,
      element: config?.element,
      index: config?.index,
      handle: config?.meta
        ? {
            meta: config.meta,
          }
        : undefined,
    });
    if (!config?.children?.length) {
      return temp;
    }
    temp.children = config.children.map(traverse);
    return temp;
  };
  return list.map(traverse);
};

const prefixedRoutes: RouteObject[] = routerList
  .filter((r) => r.path)
  .map((r) => ({ ...r, path: `/webuiapps${r.path}` }));

const standaloneMode = true;

const rootRouter: RouteObject[] = standaloneMode
  ? [
      {
        path: '*',
        element: (
          <React.Suspense>
            <Shell />
          </React.Suspense>
        ),
      },
    ]
  : generateRootRouter([...routerList, ...prefixedRoutes]);

export default rootRouter;
