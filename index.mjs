import { randomUUID } from 'node:crypto';
import { BASE_URL, createClient } from './src/client.mjs';

export function createProvider(client = createClient()) {
  function assertDestination(model) {
    if (model?.baseUrl !== BASE_URL || model?.api !== 'openai-completions' || model?.provider !== 'cenmax') {
      throw new Error('Cenmax AI requires its configured account endpoint.');
    }
  }
  return {
    id: 'cenmax', label: 'Cenmax AI',
    auth: [{
      id: 'device', label: 'Sign in with Cenmax AI', kind: 'device_code',
      async run(ctx) {
        const credential = await client.login({ signal: ctx.signal, show: async ({ url, code }) => {
          await ctx.prompter.note(`Open ${url}\nConfirm code: ${code}`, 'Cenmax AI sign-in');
          if (!ctx.isRemote) await ctx.openUrl(url).catch(() => {});
        } });
        const models = await client.models(credential.access, ctx.signal);
        if (!models.length) throw new Error('No Cenmax AI models are available for this account.');
        return {
          profiles: [{ profileId: `cenmax:${randomUUID()}`, credential }],
          defaultModel: `cenmax/${models[0].id}`,
          configPatch: { models: { providers: { cenmax: { baseUrl: BASE_URL, api: 'openai-completions', models: [] } } } },
        };
      },
    }],
    refreshOAuth: credential => client.refresh(credential),
    normalizeResolvedModel(ctx) {
      if (ctx.provider !== 'cenmax') return undefined;
      assertDestination(ctx.model);
      return ctx.model;
    },
    async prepareRuntimeAuth(ctx) {
      if (ctx.provider !== 'cenmax') return undefined;
      assertDestination(ctx.model);
      if (ctx.authMode !== 'oauth') throw new Error('Sign in with Cenmax AI before using this integration.');
      return { apiKey: ctx.apiKey, baseUrl: BASE_URL };
    },
    catalog: {
      order: 'profile',
      async run(ctx) {
        const auth = ctx.resolveProviderAuth('cenmax');
        const token = auth.discoveryApiKey || auth.apiKey;
        if (!token || auth.mode !== 'oauth') return null;
        return { provider: { baseUrl: BASE_URL, api: 'openai-completions', models: await client.models(token, ctx.signal) } };
      },
    },
  };
}

export default {
  id: 'cenmax-ai', name: 'Cenmax AI', description: 'Cenmax AI account sign-in and models',
  register(api) {
    const client = createClient();
    api.registerProvider(createProvider(client));
    api.registerModelCatalogProvider({
      provider: 'cenmax', kinds: ['text'],
      async liveCatalog(ctx) {
        const auth = ctx.resolveProviderAuth('cenmax');
        const token = auth.discoveryApiKey || auth.apiKey;
        if (!token || auth.mode !== 'oauth') return null;
        return (await client.models(token, ctx.signal)).map(m => ({ kind: 'text', provider: 'cenmax', model: m.id, label: m.name, source: 'live' }));
      },
    });
  },
};
