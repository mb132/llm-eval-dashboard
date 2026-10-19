import type * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-data", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-line", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

type TableRowProps = React.ComponentProps<"tr"> & { clickable?: boolean; selected?: boolean }

function TableRow({ className, clickable, selected, onClick, ...props }: TableRowProps) {
  return <tr className={cn("border-b border-line last:border-0 data-[state=selected]:bg-selected data-[state=expanded]:bg-selected aria-selected:bg-selected", (clickable ?? Boolean(onClick)) && "hover:bg-hover/60", selected && "bg-selected", className)} onClick={onClick} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-9 px-3 first:pl-4 last:pr-4 text-left align-middle text-caption font-medium whitespace-nowrap text-fg-muted", className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-3 first:pl-4 last:pr-4 align-top", className)} {...props} />
}

function TableGroupRow({ className, colSpan, children, ...props }: React.ComponentProps<"th"> & { colSpan: number }) {
  return <TableRow><th scope="rowgroup" colSpan={colSpan} className={cn("bg-chrome px-4 py-2 text-left text-overline uppercase text-fg-muted", className)} {...props}>{children}</th></TableRow>
}

export { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow }
