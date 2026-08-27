export function calculate(expression) {
  return expression.split(' + ').map(Number).reduce((total, value) => total + value, 0);
}
