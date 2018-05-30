import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { of } from 'rxjs/observable/of';
import { catchError } from 'rxjs/operators';
import { Observable } from 'rxjs/Observable';
import { Buffer } from 'buffer';
import * as libs from 'libsodium-wrappers';
import * as Bs58check from 'bs58check';
import * as bip39 from 'bip39';

export interface KeyPair {
  sk: string | null;
  pk: string | null;
  pkh: string;
}
@Injectable()
export class OperationService {
  nodeURL = 'https://node.tzscan.io';
  prefix = {
    tz1: new Uint8Array([6, 161, 159]),
    edpk: new Uint8Array([13, 15, 37, 217]),
    edsk: new Uint8Array([43, 246, 78, 7]),
    edsig: new Uint8Array([9, 245, 205, 134, 18]),
    o: new Uint8Array([5, 116]),
  };
  toMicro = 1000000;
  constructor(
    private http: HttpClient
  ) { }
  /*
    Returns an observable for the activation of an ICO identity
  */
  activate(pkh: string, secret: string): Observable<any> {
    console.log(pkh + ' : ' + secret);
    return this.http.post(this.nodeURL + '/blocks/head', {})
      .flatMap((head: any) => {
        const fop = {
          branch: head.hash,
          operations: [{
            kind: 'activation',
            pkh: pkh,
            secret: secret
          }
          ]
        };
        return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/forge/operations', fop)
          .flatMap((opbytes: any) => {
            const sop = {
              signedOperationContents: opbytes.operation,
              chain_id: head.chain_id
            };
            return this.http.post(this.nodeURL + '/inject_operation', sop)
              .flatMap((final: any) => {
                return of(
                  {
                    success: true,
                    payload: {
                      opHash: final.injectedOperation
                    }
                  });
              });
          });
      }).pipe(catchError(err => this.errHandler(err)));
  }
  /*
    Returns an observable for the origination of new accounts.
  */
  originate(pkh: string, amount: number, fee: number = 0, keys: KeyPair): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head', {})
      .flatMap((head: any) => {
        return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + pkh + '/counter', {})
          .flatMap((actions: any) => {
            const fop = {
              branch: head.hash,
              kind: 'manager',
              source: pkh,
              fee: (fee * this.toMicro).toString(),
              counter: ++actions.counter,
              operations: [
                {
                  kind: 'reveal',
                  public_key: keys.pk
                },
                {
                  kind: 'origination',
                  managerPubkey: keys.pkh,
                  balance: (amount * this.toMicro).toString(),
                  spendable: true,
                  delegatable: true
                }
              ]
            };
            return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/forge/operations', fop)
              .flatMap((opbytes: any) => {
                if (!keys.sk) { // If sk doesn't exist, return unsigned operation
                  return of(
                    {
                      success: true,
                      payload: {
                        unsignedOperation: opbytes.operation
                      }
                    });
                } else { // If sk exists, sign and broadcast operation
                  return this.http.post(this.nodeURL + '/blocks/head/predecessor', {})
                    .flatMap((headp: any) => {
                      const signed = this.sign(opbytes.operation, keys.sk);
                      const sopbytes = signed.sbytes;
                      const opHash = this.b58cencode(libs.crypto_generichash(32, this.hex2buf(sopbytes)), this.prefix.o);
                      const aop = {
                        pred_block: headp.predecessor,
                        operation_hash: opHash,
                        forged_operation: opbytes.operation,
                        signature: signed.edsig
                      };
                      return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/apply_operation', aop)
                        .flatMap((applied: any) => {
                          const sop = {
                            signedOperationContents: sopbytes,
                            chain_id: head.chain_id
                          };
                          return this.http.post(this.nodeURL + '/inject_operation', sop)
                            .flatMap((final: any) => {
                              return of(
                                {
                                  success: true,
                                  payload: {
                                    opHash: final.injectedOperation,
                                    newPkh: applied.contracts[0],
                                    unsignedOperation: null
                                  }
                                });
                            });
                        });
                    });
                }
              });
          });
      }).pipe(catchError(err => this.errHandler(err)));
  }
  /*
    Returns an observable for the transaction of tezzies.
  */
  transfer(from: string, to: string, amount: number, fee: number = 0, keys: KeyPair): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head', {})
      .flatMap((head: any) => {
        return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + from + '/counter', {})
          .flatMap((actions: any) => {
            const fop = {
              branch: head.hash,
              kind: 'manager',
              source: from,
              fee: (fee * this.toMicro).toString(),
              counter: ++actions.counter,
              operations: [
                {
                  kind: 'reveal',
                  public_key: keys.pk
                },
                {
                  kind: 'transaction',
                  amount: (amount * this.toMicro).toString(),
                  destination: to,
                  parameters: {
                    prim: 'Unit',
                    args: []
                  }
                }
              ]
            };
            return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/forge/operations', fop)
              .flatMap((opbytes: any) => {
                if (!keys.sk) { // If sk doesn't exist, return unsigned operation
                  return of(
                    {
                      success: true,
                      payload: {
                        unsignedOperation: opbytes.operation
                      }
                    });
                } else { // If sk exists, sign and broadcast operation
                  return this.http.post(this.nodeURL + '/blocks/head/predecessor', {})
                    .flatMap((headp: any) => {
                      const signed = this.sign(opbytes.operation, keys.sk);
                      const sopbytes = signed.sbytes;
                      const opHash = this.b58cencode(libs.crypto_generichash(32, this.hex2buf(sopbytes)), this.prefix.o);
                      const aop = {
                        pred_block: headp.predecessor,
                        operation_hash: opHash,
                        forged_operation: opbytes.operation,
                        signature: signed.edsig
                      };
                      return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/apply_operation', aop)
                        .flatMap((applied: any) => {
                          const sop = {
                            signedOperationContents: sopbytes,
                            chain_id: head.chain_id
                          };
                          return this.http.post(this.nodeURL + '/inject_operation', sop)
                            .flatMap((final: any) => {
                              return of(
                                {
                                  success: true,
                                  payload: {
                                    opHash: final.injectedOperation,
                                    unsignedOperation: null
                                  }
                                });
                            });
                        });
                    });
                }
              });
          });
      }).pipe(catchError(err => this.errHandler(err)));
  }
  /*
    Returns an observable for the delegation of baking rights.
  */
  delegate(from: string, to: string, fee: number = 0, keys: KeyPair): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head', {})
      .flatMap((head: any) => {
        return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + from + '/counter', {})
          .flatMap((actions: any) => {
            const fop = {
              branch: head.hash,
              kind: 'manager',
              source: from,
              fee: (fee * this.toMicro).toString(),
              counter: ++actions.counter,
              operations: [
                {
                  kind: 'reveal',
                  public_key: keys.pk
                },
                {
                  kind: 'delegation',
                  delegate: to
                }
              ]
            };
            return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/forge/operations', fop)
              .flatMap((opbytes: any) => {
                if (!keys.sk) { // If sk doesn't exist, return unsigned operation
                  return of(
                    {
                      unsignedOperation: opbytes.operation
                    });
                } else { // If sk exists, sign and broadcast operation
                  return this.http.post(this.nodeURL + '/blocks/head/predecessor', {})
                    .flatMap((headp: any) => {
                      const signed = this.sign(opbytes.operation, keys.sk);
                      const sopbytes = signed.sbytes;
                      const opHash = this.b58cencode(libs.crypto_generichash(32, this.hex2buf(sopbytes)), this.prefix.o);
                      const aop = {
                        pred_block: headp.predecessor,
                        operation_hash: opHash,
                        forged_operation: opbytes.operation,
                        signature: signed.edsig
                      };
                      return this.http.post(this.nodeURL + '/blocks/head/proto/helpers/apply_operation', aop)
                        .flatMap((applied: any) => {
                          const sop = {
                            signedOperationContents: sopbytes,
                            chain_id: head.chain_id
                          };
                          return this.http.post(this.nodeURL + '/inject_operation', sop)
                            .flatMap((final: any) => {
                              return of(
                                {
                                  opHash: final.injectedOperation,
                                  unsignedOperation: null
                                });
                            });
                        });
                    });
                }
              });
          });
      }).pipe(catchError(err => this.errHandler(err)));
  }
  errHandler(error: any): Observable<any> {
    return of(
      {
        success: false,
        // errorMessage: error[0].id,
        payload: {
          msg: error
        }
      }
    );
  }
  broadcast(sopbytes: string): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head', {})
      .flatMap((head: any) => {
        const sop = {
          signedOperationContents: sopbytes,
          chain_id: head.chain_id
        };
        return this.http.post(this.nodeURL + '/inject_operation', sop)
          .flatMap((final: any) => {
            return of(
              {
                success: true,
                payload: {
                  opHash: final.injectedOperation
                }
              });
          });
      }).pipe(catchError(err => this.errHandler(err)));
  }
  getBalance(pkh: string): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + pkh + '/balance', {})
      .flatMap((balance: any) => {
        return of(
          {
            success: true,
            payload: {
              balance: balance.balance
            }
          }
        );
      }).pipe(catchError(err => this.errHandler(err)));
  }
  getDelegate(pkh: string): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + pkh + '/delegate', {})
      .flatMap((delegate: any) => {
        let value = '';
        if (delegate.value) {
          value = delegate.value;
        }
        return of(
          {
            success: true,
            payload: {
              delegate: value
            }
          }
        );
      }).pipe(catchError(err => this.errHandler(err)));
  }
  getCounter(pkh: string): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + pkh + '/counter', {})
      .flatMap((counter: any) => {
        return of(
          {
            success: true,
            payload: {
              counter: counter.counter
            }
          }
        );
      }).pipe(catchError(err => this.errHandler(err)));
  }
  getAccount(pkh: string): Observable<any> {
    return this.http.post(this.nodeURL + '/blocks/head/proto/context/contracts/' + pkh, {})
      .flatMap((contract: any) => {
        let delegate = '';
        if (contract.delegate.value) {
          delegate = contract.delegate.value;
        }
        return of(
          {
            success: true,
            payload: {
              balance: contract.balance,
              manager: contract.manager,
              delegate: delegate,
              counter: contract.counter
            }
          }
        );
      }).pipe(catchError(err => this.errHandler(err)));
  }
  seed2keyPair(seed: string): KeyPair {
    const keyPair = libs.crypto_sign_seed_keypair(seed);
    return {
      sk: this.b58cencode(keyPair.privateKey, this.prefix.edsk),
      pk: this.b58cencode(keyPair.publicKey, this.prefix.edpk),
      pkh: this.b58cencode(libs.crypto_generichash(20, keyPair.publicKey), this.prefix.tz1)
    };
  }
  mnemonic2seed(mnemonic: string, passphrase: string = '') {
    return bip39.mnemonicToSeed(mnemonic, passphrase).slice(0, 32);
  }
  validMnemonic(mnemonic: string) {
    return bip39.validateMnemonic(mnemonic);
  }
  generateMnemonic(): string {
    return bip39.generateMnemonic(160);
  }
  pk2pkh(pk: string): string {
    const pkDecoded = this.b58cdecode(pk, this.prefix.edpk);
    return this.b58cencode(libs.crypto_generichash(20, pkDecoded), this.prefix.tz1);
  }
  hex2buf(hex) {
    return new Uint8Array(hex.match(/[\da-f]{2}/gi).map(function (h) {
      return parseInt(h, 16);
    }));
  }
  buf2hex(buffer) {
    const byteArray = new Uint8Array(buffer), hexParts = [];
    for (let i = 0; i < byteArray.length; i++) {
      const hex = byteArray[i].toString(16);
      const paddedHex = ('00' + hex).slice(-2);
      hexParts.push(paddedHex);
    }
    return hexParts.join('');
  }
  b58cencode(payload: any, prefixx: Uint8Array) {
    const n = new Uint8Array(prefixx.length + payload.length);
    n.set(prefixx);
    n.set(payload, prefixx.length);
    return Bs58check.encode(new Buffer(this.buf2hex(n), 'hex'));
  }
  b58cdecode(enc, prefixx) {
    let n = Bs58check.decode(enc);
    n = n.slice(prefixx.length);
    return n;
  }
  sign(bytes, sk): any {
    const hash = libs.crypto_generichash(32, this.hex2buf(bytes));
    const sig = libs.crypto_sign_detached(hash, this.b58cdecode(sk, this.prefix.edsk), 'uint8array');
    const edsig = this.b58cencode(sig, this.prefix.edsig);
    const sbytes = bytes + this.buf2hex(sig);
    return {
      bytes: bytes,
      sig: sig,
      edsig: edsig,
      sbytes: sbytes,
    };
  }
}
