export function PageSizeSelect({value,onChange}:{value:number;onChange:(value:number)=>void}) {
  const choices=[10,20,25,50,100];if(!choices.includes(value))choices.push(value);choices.sort((a,b)=>a-b);
  return <label className="page-size-control"><span>Số dòng</span><select aria-label="Số dòng mỗi trang" value={value} onChange={event=>onChange(Number(event.target.value))}>{choices.map(size=><option key={size} value={size}>{size}</option>)}</select></label>;
}
