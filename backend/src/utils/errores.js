/** Error de negocio con código HTTP. Lo convierte en respuesta el manejador central de app.js */
export class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}
