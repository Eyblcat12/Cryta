// Generates a disposable Keycloak realm. Its output contains test credentials.
// Pass a path inside the caller's ignored artifact directory and do not upload it.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [directory, callbackInput, backchannelInput] = process.argv.slice(2);
const root = path.resolve(__dirname,'../test-artifacts');
const destination = path.resolve(directory);
assert.ok(destination.startsWith(root+path.sep));
assert.match(path.basename(destination),/^keycloak-test-[a-f0-9]{12}$/);
const callback = new URL(callbackInput);
assert.equal(callback.protocol,'http:');
assert.equal(callback.hostname,'127.0.0.1');
assert.equal(callback.pathname,'/api/v1/auth/oidc/callback');
assert.ok(callback.port && callback.port!=='8080');
assert.ok(!callback.username&&!callback.password&&!callback.search&&!callback.hash);
const backchannel = new URL(backchannelInput);
assert.equal(backchannel.href,'http://backend:3000/api/v1/auth/oidc/backchannel');
const randomCredential = () => randomBytes(32).toString('base64url');
const clientSecret = randomCredential();
const linked = { username:'linked-reviewer',email:'reviewer@example.test',firstName:'Linked',lastName:'Reviewer',subject:randomUUID(),password:randomCredential() };
const colliding = { username:'unlinked-reviewer',email:'collision@example.test',firstName:'Unlinked',lastName:'Reviewer',subject:randomUUID(),password:randomCredential() };
const realm = {
  realm:'crypta-oidc-test', enabled:true, sslRequired:'none', registrationAllowed:false,
  loginWithEmailAllowed:false, resetPasswordAllowed:false,
  accessTokenLifespan:120, ssoSessionIdleTimeout:300, ssoSessionMaxLifespan:600,
  clients:[{
    clientId:'crypta-oidc-test', protocol:'openid-connect', enabled:true,
    publicClient:false, clientAuthenticatorType:'client-secret', secret:clientSecret,
    standardFlowEnabled:true, implicitFlowEnabled:false, directAccessGrantsEnabled:false,
    serviceAccountsEnabled:false, redirectUris:[callback.href], webOrigins:[],
    attributes:{ 'pkce.code.challenge.method':'S256', 'backchannel.logout.url':backchannel.href,
      'backchannel.logout.session.required':'true' },
  }],
  users:[linked,colliding].map(user=>({id:user.subject,username:user.username,email:user.email,
    firstName:user.firstName,lastName:user.lastName,enabled:true,emailVerified:true,
    credentials:[{type:'password',value:user.password,temporary:false}]})),
};
fs.mkdirSync(destination,{mode:0o700});
fs.writeFileSync(path.join(destination,'crypta-oidc-test-realm.json'),JSON.stringify(realm),{mode:0o600,flag:'wx'});
fs.writeFileSync(path.join(destination,'test-credentials.json'),JSON.stringify({clientSecret,linked,colliding}),{mode:0o600,flag:'wx'});
console.log('Generated isolated Keycloak realm and credentials.');
