#include "../redismodule.h"
#include "../rmutil/util.h"
#include "../rmutil/strings.h"
#include "../rmutil/test_util.h"

#include "./id/id.h"

int SelvaCommand_GenId(RedisModuleCtx *ctx, RedisModuleString **argv, int argc) {
  // init auto memory for created strings
  RedisModule_AutoMemory(ctx);

  if (argc > 2) {
    return RedisModule_WrongArity(ctx);
  }

  char hash_str[37];
  SelvaId_GenId(hash_str);

  RedisModuleString *reply =
      RedisModule_CreateString(ctx, hash_str, strlen(hash_str) * sizeof(char));
  RedisModule_ReplyWithString(ctx, reply);
  return REDISMODULE_OK;
}


int SelvaCommand_Flurpy(RedisModuleCtx *ctx, RedisModuleString **argv, int argc) {
  // init auto memory for created strings
  RedisModule_AutoMemory(ctx);


  RedisModuleString *keyStr = RedisModule_CreateString(ctx, "flurpypants", strlen("flurpypants") * sizeof(char));
  RedisModuleString *val = RedisModule_CreateString(ctx, "hallo", strlen("hallo") * sizeof(char));
  RedisModuleKey *key = RedisModule_OpenKey(ctx, keyStr, REDISMODULE_WRITE);
  for (int i = 0; i < 10000; i++) {
    RedisModule_StringSet(key, val);
    // RedisModuleCallReply *r = RedisModule_Call(ctx, "publish", "x", "y");
  }

  RedisModule_CloseKey(key);
  RedisModuleString *reply =
    RedisModule_CreateString(ctx, "hallo", strlen("hallo") * sizeof(char));
  RedisModule_ReplyWithString(ctx, reply);
  return REDISMODULE_OK;

}


int RedisModule_OnLoad(RedisModuleCtx *ctx) {

  // Register the module itself
  if (RedisModule_Init(ctx, "selva", 1, REDISMODULE_APIVER_1) == REDISMODULE_ERR) {
    return REDISMODULE_ERR;
  }

  if (RedisModule_CreateCommand(ctx, "selva.id", SelvaCommand_GenId, "readonly", 1, 1, 1) == REDISMODULE_ERR) {
    return REDISMODULE_ERR;
  }

  if (RedisModule_CreateCommand(ctx, "selva.flurpypants", SelvaCommand_Flurpy, "readonly", 1, 1, 1) == REDISMODULE_ERR) {
    return REDISMODULE_ERR;
  }

  return REDISMODULE_OK;
}
